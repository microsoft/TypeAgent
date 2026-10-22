// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateRange } from "./interfaces.js";
import { MessageTemporalContext } from "./temporalSchema.js";
import { Knowledge } from "./interfaces.js";

export type AnswerContext = {
    // Relevant entities
    // Use the 'name' and 'type' properties of entities to PRECISELY identify those that answer the user question.
    entities?: RelevantKnowledge[] | undefined;
    // Relevant topics
    topics?: RelevantKnowledge[] | undefined;
    // Relevant messages
    messages?: RelevantMessage[] | undefined;
};

export type EntityNames = string | string[];

export type RelevantKnowledge = {
    // Original, unmerged statements preserve per-fact attribution and conflicting values.
    evidence?: {
        semanticRefOrdinal: number;
        sourceMessageOrdinal: number;
        knowledge?: Knowledge;
        temporalContext?: MessageTemporalContext | undefined;
    }[];
    sourceMessageOrdinals?: number[] | undefined;
    // The actual knowledge
    knowledge: any;
    // Entity or entities who mentioned the knowledge
    origin?: EntityNames | undefined;
    // Entity or entities who received or consumed this knowledge
    audience?: EntityNames | undefined;
    // Time period during which this knowledge was gathered
    timeRange?: DateRange | undefined;
};

export type RelevantMessage = {
    temporalContext?: MessageTemporalContext | undefined;
    sourceMessageOrdinals?: number[] | undefined;
    from?: EntityNames | undefined;
    to?: EntityNames | undefined;
    timestamp?: Date | undefined;
    // Text chunks in this message
    messageText?: string | string[] | undefined;
};
