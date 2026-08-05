// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import type {
    QueryIrV1,
    ResolvedTimezone,
    TemporalSelector,
} from "../ir/index.js";

export type QueryLanguageOptions = {
    scopeId: string;
    timeZone: string;
    now: Date;
    defaultTokenBudget?: number;
    defaultMaxResults?: number;
};

export type TemporalResolution = {
    selector: TemporalSelector;
    timezone: ResolvedTimezone;
};

export interface TemporalResolver {
    resolve(
        expression: string,
        mode: "during" | "asOf" | "changedDuring",
        options: Pick<QueryLanguageOptions, "timeZone" | "now">,
        changedProjection?: "matchingEvents" | "endState",
    ): TemporalResolution;
}

export type ParsedQuery = {
    query: QueryIrV1;
    sourceText: string;
};
