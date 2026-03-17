// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

import { ParamValueType, RequestAction } from "../explanation/requestAction.js";

export type MatchResult = {
    type: "grammar" | "construction";
    match: RequestAction;
    matchedCount: number;
    wildcardCharCount: number;
    nonOptionalCount: number;
    implicitParameterCount: number;
    entityWildcardPropertyNames: string[];
    conflictValues?: [string, ParamValueType[]][] | undefined;
    partialPartCount?: number | undefined; // Only used for partial match
    partialMatchedCurrent?: number | undefined; // Character offset where partial matching stopped
    matchedStarts?: readonly number[] | undefined; // Start position of each matched part (partial only; -1 = optional skipped)
};

export interface GrammarStore {
    setEnabled(enabled: boolean): void;
    addGrammar(namespace: string, grammar: any): void;
    removeGrammar(namespace: string): void;
    setUseNFA(useNFA: boolean): void;
    setUseDFA(useDFA: boolean): void;
}
