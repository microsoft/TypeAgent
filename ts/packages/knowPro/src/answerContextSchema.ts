// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { DateRange } from "./interfaces.js";

export type AnswerContext = {
    // Relevant entities
    entities?: RelevantKnowledge[] | undefined;
    // Relevant topics
    topics?: RelevantKnowledge[] | undefined;
};

export type RelevantKnowledge = {
    // The actual knowledge
    knowledge: any;
    // Entity or entities where the knowledge originated
    origin?: string | string[] | undefined;
    // Entity or entities who received or consumed this knowledge
    audience?: string | string[] | undefined;
    // Time period during which this knowledge was gathered
    timeRange?: DateRange | undefined;
};
