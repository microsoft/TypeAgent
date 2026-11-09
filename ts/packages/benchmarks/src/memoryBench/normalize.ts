// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type { Document, Turn } from "./types.js";
import { list, object, text } from "./storage.js";

const months = [
    "january",
    "february",
    "march",
    "april",
    "may",
    "june",
    "july",
    "august",
    "september",
    "october",
    "november",
    "december",
];
function calendar(
    year: number,
    month: number,
    day: number,
    hour = 0,
    minute = 0,
): string {
    const date = new Date(Date.UTC(year, month, day, hour, minute));
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month ||
        date.getUTCDate() !== day ||
        hour > 23 ||
        minute > 59
    )
        throw new Error("Invalid source date");
    return date.toISOString().replace(".000Z", "+00:00");
}
function monthNumber(name: string): number {
    const result = months.findIndex(
        (month) =>
            month === name.toLowerCase() ||
            month.slice(0, 3) === name.toLowerCase(),
    );
    if (result < 0) throw new Error("Unrecognized month");
    return result;
}
export function timestamp(raw: string): string {
    const beam = /^([a-z]+)-(\d{1,2})-(\d{4})$/i.exec(raw);
    if (beam)
        return calendar(Number(beam[3]), monthNumber(beam[1]), Number(beam[2]));
    if (!/^\d{4}-\d{2}-\d{2}(?:T[\d:.]+(?:Z|[+-]\d{2}:\d{2})?)?$/.test(raw))
        throw new Error(`Unrecognized source date: ${raw}`);
    const date = new Date(
        raw.endsWith("Z") || /[+-]\d{2}:\d{2}$/.test(raw)
            ? raw
            : `${raw.length === 10 ? raw + "T00:00:00" : raw}Z`,
    );
    if (!Number.isFinite(date.getTime()))
        throw new Error("Invalid source date");
    return date.toISOString().replace(".000Z", "+00:00");
}
function finish(turn: Omit<Turn, "content" | "timestamp">): Turn {
    return {
        ...turn,
        timestamp: timestamp(turn.originalTime),
        content: `[Session ${turn.session}; date ${turn.originalTime}; turn ${turn.originalId}; speaker ${turn.speaker}]\n${turn.text}`,
    };
}
function validate(turns: Turn[]): Turn[] {
    if (
        !turns.length ||
        new Set(turns.map((turn) => turn.identity)).size !== turns.length
    )
        throw new Error("Empty transcript or duplicate turn identities");
    return turns;
}
function isTurn(value: unknown): boolean {
    return !!value && typeof value === "object" && "role" in value;
}
function batchTurns(value: unknown): Record<string, unknown>[] {
    return list(value).flatMap((group) => {
        if (isTurn(group)) return [object(group)];
        const turns = list(group);
        if (!turns.every(isTurn))
            throw new Error("Unsupported BEAM turn group");
        return turns.map(object);
    });
}
export function beamSessions(value: unknown): Record<string, unknown>[][] {
    const items = list(value);
    if (!items.length) throw new Error("Empty BEAM chat");
    if (items.every(isTurn)) return [items.map(object)];
    return items.flatMap((item) => {
        if (Array.isArray(item)) return beamSessions(item);
        const record = object(item);
        if ("turns" in record) {
            const turns = batchTurns(record.turns);
            if (!turns.length) throw new Error("Empty BEAM batch");
            return [turns];
        }
        const keys = Object.keys(record);
        if (!keys.length || !keys.every((key) => /^plan[-_]\d+$/.test(key)))
            throw new Error("Unsupported BEAM session structure");
        return Object.values(record).flatMap(beamSessions);
    });
}
export function beamTurns(chat: unknown): Turn[] {
    return validate(
        beamSessions(chat).flatMap((session, ordinal) => {
            const anchor = session.find(
                (item) => item.time_anchor,
            )?.time_anchor;
            return session.map((item, index) => {
                const role = text(item.role).toLowerCase();
                if (
                    role !== "user" &&
                    role !== "assistant" &&
                    role !== "system" &&
                    role !== "tool"
                )
                    throw new Error(`Unsupported BEAM role: ${role}`);
                const originalId = String(item.id ?? index);
                return finish({
                    identity: `s${ordinal}:t${index}:${originalId}`,
                    originalId,
                    session: String(ordinal),
                    role,
                    speaker: role,
                    text: text(item.content),
                    originalTime: text(item.time_anchor || anchor),
                    timeSource: item.time_anchor ? "turn" : "session",
                });
            });
        }),
    );
}
export function chunkTurns(turns: Turn[], maxChars = 80000): Turn[][] {
    if (maxChars < 1) throw new Error("Chunk limit must be positive");
    const groups: Turn[][] = [];
    let current: Turn[] = [],
        size = 0;
    for (const turn of turns) {
        const length = Array.from(turn.content).length + 2;
        if (
            current.length &&
            (size + length > maxChars || turn.session !== current[0].session)
        ) {
            groups.push(current);
            current = [];
            size = 0;
        }
        current.push(turn);
        size += length;
    }
    if (current.length) groups.push(current);
    return groups;
}
export function documentsFor(unit: string, turns: Turn[]): Document[] {
    return chunkTurns(turns).map((messages, ordinal) => ({
        id: `${unit}_${messages[0].session}_${ordinal}`,
        unit,
        title: `Conversation ${unit}; session ${messages[0].session}; date ${messages[0].originalTime}`,
        timestamp: messages[0].timestamp,
        messages,
        content: messages.map((turn) => turn.content).join("\n\n"),
        sourceIds: [`${unit}_${messages[0].session}`, unit],
    }));
}
