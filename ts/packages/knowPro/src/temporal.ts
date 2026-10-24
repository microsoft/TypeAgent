// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { createHash } from "node:crypto";
import type {
    MessageTemporalContext,
    SourceTemporalContext,
    SourceTemporalScope,
    TemporalMention,
    TemporalQueryRange,
    TemporalValue,
} from "./temporalSchema.js";

export const relativeTimeInstructions = [
    "Interpret temporally used 'just', 'recently', 'soon' and similar expressions as context-dependent time windows, not exact dates or universal fixed offsets. Infer direction, scale and anchor from the event, tense and surrounding evidence. Non-temporal uses such as 'just one' are not date evidence. An expression relative to another event uses that event's anchor, not automatically the message date.",
    "Anchor source-relative windows to the owning source message, and query-relative windows to the question reference time. Do not substitute import, index or current system time, cross source/quotation ownership, or assume a timezone for a floating date. Explicit dates, explicit relative days and contradictory evidence take precedence over vague recency.",
    "Give a useful qualified answer, approximate interval or supported bound when the evidence permits it; do not require a literally stated event date merely to avoid all inference. State the assumptions and cite the evidence for each operand. A brief completed activity described as immediate can support an approximate day-level comparison using its message calendar, provided there is no contrary evidence; identify this as an inference, not an explicit same-day fact. Wider or unclear windows require wider bounds or an explanation of the missing precision, not an invented exact day. Match precision to the evidence: duration plus a message timestamp can bound an event, but does not fix its endpoints to the message time or justify an unsupported minute-level estimate.",
    "Respect midnight boundaries, activity duration and multi-day travel: a recent return does not date every activity during a trip. 'Recently' can have different scales for a meal, a job change or a historical event; do not impose a fixed number of days. 'Soon' indicates an expected or intended future window, not proof that the event occurred. Preserve uncertainty when windows overlap rather than inventing an exact ordering, count or duration.",
    "Do not turn an inferred vague window into a hard retrieval date cutoff without supported bounds or an explicit user policy. Retrieve broadly enough to evaluate the temporal wording in context. Preserve source wording and canonical dates; do not promote a reader inference into an authoritative stored event date.",
].join(" ");

export class TemporalValueError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "TemporalValueError";
    }
}

function calendarDate(parts: number[]): Date {
    const [year, month, day, hour = 0, minute = 0, second = 0, ms = 0] = parts;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(hour, minute, second, ms);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day ||
        date.getUTCHours() !== hour ||
        date.getUTCMinutes() !== minute ||
        date.getUTCSeconds() !== second ||
        date.getUTCMilliseconds() !== ms
    )
        throw new TemporalValueError("Invalid temporal calendar components");
    return date;
}

function parseRfcTemporalValue(raw: string): TemporalValue | undefined {
    const rfc =
        /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3})\s+(\d{4})\s+(\d{2}):(\d{2})(?::(\d{2}))?(?:\s+([A-Za-z]{1,5}|[+-]\d{4}))?$/i.exec(
            raw.trim(),
        );
    if (rfc) {
        const month =
            [
                "jan",
                "feb",
                "mar",
                "apr",
                "may",
                "jun",
                "jul",
                "aug",
                "sep",
                "oct",
                "nov",
                "dec",
            ].indexOf(rfc[2].toLowerCase()) + 1;
        const zone =
            rfc[7] && /^(Z|UT|UTC|GMT)$/i.test(rfc[7])
                ? "Z"
                : rfc[7] && /^[+-]/.test(rfc[7])
                  ? rfc[7]
                  : "";
        const spelling = `${rfc[3]}-${String(month).padStart(2, "0")}-${rfc[1].padStart(2, "0")}T${rfc[4]}:${rfc[5]}${rfc[6] ? `:${rfc[6]}` : ""}${zone}`;
        return { ...parseTemporalValue(spelling), raw };
    }
    return undefined;
}

function parseTemporalPeriod(raw: string): TemporalValue {
    const period = /^(\d{4})(?:-(\d{2}))?$/.exec(raw.trim());
    if (!period)
        throw new TemporalValueError(
            "Unsupported or invalid source date format",
        );
    calendarDate([Number(period[1]), Number(period[2] ?? 1), 1]);
    return {
        raw,
        kind: "calendar",
        precision: period[2] ? "month" : "year",
        localDateTime: period[0],
    };
}

export function parseTemporalValue(raw: string): TemporalValue {
    if (typeof raw !== "string")
        throw new TemporalValueError(
            "A temporal value must be a source date string",
        );
    const rfc = parseRfcTemporalValue(raw);
    if (rfc) return rfc;
    const match =
        /^(\d{4})[-/](\d{2})[-/](\d{2})(?: \([A-Za-z]{3}\))?(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/.exec(
            raw.trim(),
        );
    if (!match) return parseTemporalPeriod(raw);
    const parts = [
        Number(match[1]),
        Number(match[2]),
        Number(match[3]),
        Number(match[4] ?? 0),
        Number(match[5] ?? 0),
        Number(match[6] ?? 0),
        Number((match[7] ?? "").padEnd(3, "0")),
    ];
    const date = calendarDate(parts);
    const normalized = date.toISOString();
    const precision = match[7]
        ? "millisecond"
        : match[6]
          ? "second"
          : match[4]
            ? "minute"
            : "day";
    const localDateTime = normalized.slice(
        0,
        precision === "day"
            ? 10
            : precision === "minute"
              ? 16
              : precision === "second"
                ? 19
                : 23,
    );
    const offset = match[8];
    if (!offset || offset === "-0000" || offset === "-00:00")
        return {
            raw,
            kind: match[4] ? "floating" : "calendar",
            precision,
            localDateTime,
        };
    const offsetParts = /([+-])(\d{2}):?(\d{2})/.exec(offset);
    const offsetMinutes = offsetParts
        ? (offsetParts[1] === "-" ? -1 : 1) *
          (Number(offsetParts[2]) * 60 + Number(offsetParts[3]))
        : 0;
    if (
        offsetParts &&
        (Number(offsetParts[3]) > 59 || Math.abs(offsetMinutes) > 14 * 60)
    )
        throw new TemporalValueError("Invalid temporal UTC offset");
    return {
        raw,
        kind: "instant",
        precision,
        localDateTime,
        offsetMinutes,
        instantUtc: new Date(
            date.getTime() - offsetMinutes * 60_000,
        ).toISOString(),
    };
}

export function validateTemporalValue(value: TemporalValue): TemporalValue {
    const normalized = parseTemporalValue(value.raw);
    if (
        normalized.kind !== value.kind ||
        normalized.precision !== value.precision ||
        normalized.localDateTime !== value.localDateTime ||
        normalized.instantUtc !== value.instantUtc ||
        normalized.offsetMinutes !== value.offsetMinutes
    )
        throw new Error(
            "Canonical temporal value does not match its source date",
        );
    return normalized;
}

export function normalizeTemporalContext(
    context: SourceTemporalContext,
    textLength: number,
): SourceTemporalContext {
    if (context.version !== 1 || !Array.isArray(context.scopes))
        throw new Error("Unsupported source temporal context");
    const owners = new Set<string>();
    const scopes = context.scopes
        .map((scope): SourceTemporalScope => {
            if (
                !scope.ownerId ||
                owners.has(scope.ownerId) ||
                !Number.isSafeInteger(scope.start) ||
                !Number.isSafeInteger(scope.end) ||
                scope.start < 0 ||
                scope.end > textLength ||
                scope.start > textLength ||
                scope.end < scope.start ||
                (scope.start === scope.end && textLength !== 0)
            )
                throw new Error("Invalid or duplicate source temporal scope");
            owners.add(scope.ownerId);
            return {
                ownerId: scope.ownerId,
                start: scope.start,
                end: scope.end,
                ...(scope.role === undefined ? {} : { role: scope.role }),
                ...(scope.messageTime === undefined
                    ? {}
                    : {
                          messageTime:
                              typeof scope.messageTime === "string"
                                  ? parseTemporalValue(scope.messageTime)
                                  : validateTemporalValue(scope.messageTime),
                      }),
            };
        })
        .sort(
            (a, b) =>
                a.start - b.start ||
                b.end - a.end ||
                a.ownerId.localeCompare(b.ownerId),
        );
    for (let i = 0; i < scopes.length; i++) {
        for (let j = i + 1; j < scopes.length; j++) {
            const a = scopes[i];
            const b = scopes[j];
            if (
                (a.start === b.start && a.end === b.end) ||
                (a.start < b.start && b.start < a.end && a.end < b.end) ||
                (b.start < a.start && a.start < b.end && b.end < a.end)
            )
                throw new Error("Conflicting temporal scope boundaries");
        }
    }
    return { version: 1, scopes };
}

export function temporalContextFromHeaders(
    text: string,
): SourceTemporalContext | undefined {
    const headers = [...text.matchAll(/^Session date:([^\r\n]+)$/gm)];
    if (!headers.length) return undefined;
    return normalizeTemporalContext(
        {
            version: 1,
            scopes: headers.map((header, index) => ({
                ownerId: `session-header:${header.index}`,
                start: header.index,
                end: headers[index + 1]?.index ?? text.length,
                messageTime: header[1].trimStart(),
            })),
        },
        text.length,
    );
}

export function temporalSegments(
    text: string,
    context: SourceTemporalContext,
    revisionId: string,
): { text: string; context?: MessageTemporalContext }[] {
    context = normalizeTemporalContext(context, text.length);
    const boundaries = [
        ...new Set([
            0,
            text.length,
            ...context.scopes.flatMap((s) => [s.start, s.end]),
        ]),
    ].sort((a, b) => a - b);
    for (const boundary of boundaries)
        if (
            boundary > 0 &&
            boundary < text.length &&
            /[\uD800-\uDBFF]/.test(text[boundary - 1]) &&
            /[\uDC00-\uDFFF]/.test(text[boundary])
        )
            throw new Error(
                "Temporal scope boundary splits a UTF-16 surrogate pair",
            );
    const contextHash = createHash("sha256")
        .update(JSON.stringify(context))
        .digest("hex");
    return boundaries.slice(0, -1).map((start, index) => {
        const end = boundaries[index + 1];
        const scopes = context.scopes
            .filter((scope) => scope.start <= start && scope.end >= end)
            .sort((a, b) => b.end - b.start - (a.end - a.start));
        const owner = scopes.at(-1);
        const evidence = scopes.flatMap((scope) =>
            scope.messageTime === undefined
                ? []
                : [
                      {
                          id: `${scope.ownerId}:messageTime`,
                          role: "messageTime" as const,
                          locator: `source.temporalContext:${scope.ownerId}`,
                          value:
                              typeof scope.messageTime === "string"
                                  ? parseTemporalValue(scope.messageTime)
                                  : scope.messageTime,
                      },
                  ],
        );
        return {
            text: text.slice(start, end),
            ...(owner
                ? {
                      context: {
                          version: 1 as const,
                          sourceRevisionId: revisionId,
                          contextHash,
                          sourceContextHash: contextHash,
                          ownerId: owner.ownerId,
                          role: owner.role,
                          sourceSpan: { start, end },
                          messageTime: evidence.at(-1)?.value,
                          inheritedDateEvidence: evidence,
                      },
                  }
                : {}),
        };
    });
}

export function resolveRelativeDate(
    phrase: string,
    anchor: TemporalValue | undefined,
): TemporalValue | undefined {
    const offsets: Record<string, number | undefined> = {
        yesterday: -1,
        today: 0,
        tomorrow: 1,
    };
    const days = offsets[phrase.toLowerCase()];
    if (days === undefined || !anchor || anchor.localDateTime.length < 10)
        return undefined;
    const [year, month, day] = anchor.localDateTime
        .slice(0, 10)
        .split("-")
        .map(Number);
    const date = calendarDate([year, month, day]);
    date.setUTCDate(date.getUTCDate() + days);
    return parseTemporalValue(date.toISOString().slice(0, 10));
}

export function temporalMentions(
    text: string,
    context: MessageTemporalContext,
): TemporalMention[] {
    const relative = [...text.matchAll(/\b(today|yesterday|tomorrow)\b/gi)].map(
        (match): TemporalMention => {
            const value = resolveRelativeDate(match[0], context.messageTime);
            return {
                text: match[0],
                start: match.index,
                end: match.index + match[0].length,
                role: "eventTime",
                value,
                anchorId: context.inheritedDateEvidence
                    .filter((evidence) => evidence.role === "messageTime")
                    .at(-1)?.id,
                resolution: value ? "resolved" : "missing-anchor",
            };
        },
    );
    return relative;
}

export function matchesTemporalRange(
    context:
        | Pick<
              MessageTemporalContext,
              "messageTime" | "eventMentions" | "discoveredDateEvidence"
          >
        | undefined,
    range: TemporalQueryRange,
): boolean {
    if (
        !["message", "event"].includes(range.dimension) ||
        !["instant", "calendar"].includes(range.domain)
    )
        throw new Error("Invalid temporal query dimension or domain");
    const bound = (text: string) => {
        const value = parseTemporalValue(text);
        if (range.domain === "instant" && value.instantUtc === undefined)
            throw new Error(
                "Instant query bounds require an explicit UTC offset",
            );
        return range.domain === "instant"
            ? value.instantUtc!
            : value.localDateTime;
    };
    const start = bound(range.start);
    const end = range.end === undefined ? undefined : bound(range.end);
    if (end !== undefined && start > end)
        throw new Error("Temporal query range ends before it starts");
    const values =
        range.dimension === "message"
            ? [context?.messageTime]
            : [
                  ...(context?.eventMentions ?? []).map(
                      (mention) => mention.value,
                  ),
                  ...(context?.discoveredDateEvidence ?? [])
                      .filter((evidence) => evidence.role === "eventTime")
                      .map((evidence) => evidence.value),
              ];
    return values.some((value) => {
        if (!value) return false;
        const key =
            range.domain === "instant" ? value.instantUtc : value.localDateTime;
        if (!key) return false;
        return (
            key >= start &&
            (end === undefined || key.slice(0, end.length) <= end)
        );
    });
}
