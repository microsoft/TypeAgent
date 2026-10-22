// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type TemporalValue = {
    raw: string;
    kind: "instant" | "floating" | "calendar";
    precision: "year" | "month" | "day" | "minute" | "second" | "millisecond";
    localDateTime: string;
    instantUtc?: string;
    offsetMinutes?: number;
};

export type SourceTemporalScope = {
    ownerId: string;
    start: number;
    end: number;
    messageTime?: string | TemporalValue;
    role?: string;
};

export type SourceTemporalContext = {
    version: 1;
    scopes: SourceTemporalScope[];
};

export type TemporalMention = {
    chunkOrdinal?: number;
    text: string;
    start: number;
    end: number;
    role: "eventTime";
    value?: TemporalValue | undefined;
    anchorId?: string | undefined;
    resolution: "resolved" | "missing-anchor" | "ambiguous";
};

export type MessageTemporalContext = {
    version: 1;
    sourceRevisionId: string;
    contextHash: string;
    sourceContextHash?: string;
    ownerId: string;
    role?: string | undefined;
    partOrdinal?: number;
    sourceSpan: { start: number; end: number };
    messageTime?: TemporalValue | undefined;
    inheritedDateEvidence: {
        id: string;
        role: "messageTime" | "eventTime";
        locator: string;
        value: TemporalValue;
        quote?: string;
        chunkOrdinal?: number;
    }[];
    discoveredDateEvidence?: {
        id: string;
        role: "messageTime" | "eventTime";
        locator: string;
        value: TemporalValue;
        quote?: string;
        chunkOrdinal?: number;
    }[];
    eventMentions?: TemporalMention[];
};

export type TemporalQueryRange = {
    dimension: "message" | "event";
    domain: "instant" | "calendar";
    start: string;
    end?: string;
};

export type TemporalQueryContext = {
    referenceTime?: TemporalValue | string;
    availabilityPolicy?: "supplied-history" | "as-of";
};
