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

type EventScan = {
    sawEvent: boolean;
    response: string[];
    knowledge: KnowledgePayload | undefined;
};

/**
 * Scan Copilot session events with the same semantics as the extension's
 * trace assembler: subagent events (agentId) are ignored, each root
 * user.message starts a new turn, an aborted idle discards the turn in
 * progress, and a turn's assistant.message contents form one response.
 */
function scanEventStream(items: readonly unknown[]): EventScan {
    const scan: EventScan = {
        sawEvent: false,
        response: [],
        knowledge: undefined,
    };
    for (const item of items) {
        const record = asRecord(item);
        if (!record || typeof record.type !== "string") {
            continue;
        }
        scan.sawEvent = true;
        if (record.agentId !== undefined) {
            continue;
        }
        switch (record.type) {
            case "user.message":
                scan.response.length = 0;
                scan.knowledge = undefined;
                break;
            case "assistant.message": {
                const data = asRecord(record.data);
                const content = data
                    ? readString(
                          data,
                          "content",
                          "text",
                          "response",
                          "lastAssistantMessage",
                          "last_assistant_message",
                      )
                    : undefined;
                if (content) {
                    scan.response.push(content);
                }
                const knowledge = parseKnowledge(
                    record.knowledge ?? data?.knowledge,
                );
                if (knowledge) {
                    scan.knowledge = knowledge;
                }
                break;
            }
            case "session.idle":
                if (asRecord(record.data)?.aborted === true) {
                    scan.response.length = 0;
                    scan.knowledge = undefined;
                }
                break;
        }
    }
    return scan;
}

function scannedTurn(scan: EventScan): AssistantTurn | undefined {
    if (scan.response.length === 0) {
        return undefined;
    }
    const text = scan.response.join("");
    return scan.knowledge ? { text, knowledge: scan.knowledge } : { text };
}

function parseJsonLine(line: string): unknown {
    const text = line.trim();
    if (!text.startsWith("{") && !text.startsWith("[")) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    } catch {
        return undefined;
    }
}

/**
 * Latest assistant text in a Copilot `events.jsonl` transcript, a JSON
 * message list, or a plain-text file. Optional knowledge rides along when
 * the stop payload or the event includes it. Structured input that holds
 * no assistant response (for example a cancelled last turn) returns
 * undefined rather than storing raw JSONL as turn text.
 */
export function extractAssistantTurn(raw: string): AssistantTurn | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }
    const lines = trimmed.split(/\r?\n/);
    const parsedLines = lines.map(parseJsonLine);
    const sawStructured = parsedLines.some((parsed) => parsed !== undefined);

    const scan = scanEventStream(parsedLines);
    if (scan.sawEvent) {
        return scannedTurn(scan);
    }

    // Whole-file JSON: an event array, a message list, or a single record.
    if (parsedLines.length === 1 && parsedLines[0] !== undefined) {
        const parsed = parsedLines[0];
        if (Array.isArray(parsed)) {
            const arrayScan = scanEventStream(parsed);
            if (arrayScan.sawEvent) {
                return scannedTurn(arrayScan);
            }
            let latest: AssistantTurn | undefined;
            for (const item of parsed) {
                const text = textFromAssistantEvent(item);
                if (text) {
                    latest = { text };
                }
            }
            return latest;
        }
        const text = textFromAssistantEvent(parsed);
        if (!text) {
            return undefined;
        }
        const knowledge = parseKnowledge(asRecord(parsed)?.knowledge);
        return knowledge ? { text, knowledge } : { text };
    }

    // Line-delimited message records (non-event JSONL).
    let latest: AssistantTurn | undefined;
    for (const parsed of parsedLines) {
        if (parsed === undefined) {
            continue;
        }
        const text = textFromAssistantEvent(parsed);
        if (text) {
            const knowledge = parseKnowledge(asRecord(parsed)?.knowledge);
            latest = knowledge ? { text, knowledge } : { text };
        }
    }
    if (latest) {
        return latest;
    }
    return sawStructured ? undefined : { text: trimmed };
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
