// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParamValueType, RequestAction } from "../explanation/requestAction.js";

export type MatchResult = {
    match: RequestAction;
    matchedCount: number;
    wildcardCharCount: number;
    nonOptionalCount: number;
    implicitParameterCount: number;
    entityWildcardPropertyNames: string[];
    conflictValues?: [string, ParamValueType[]][] | undefined;
    partialPartCount?: number | undefined; // Only used for partial match
};

export interface GrammarStore {
    addGrammar(namespace: string, grammar: any): void;
}
