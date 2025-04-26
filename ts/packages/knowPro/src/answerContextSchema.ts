// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateRange } from "./interfaces.js";

export type AnswerContext = {
    // Relevant entities
    entities?: RelevantKnowledge[] | undefined;
    // Relevant topics
    topics?: RelevantKnowledge[] | undefined;
    // Relevant messages
    messages?: RelevantMessage[] | undefined;
};

export type EntityNames = string | string[];

export type RelevantKnowledge = {
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
    // Message text
    message: string;
    from?: EntityNames | undefined;
    to?: EntityNames | undefined;
    timestamp?: Date | undefined;
};
