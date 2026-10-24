// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export type DatasetName = "beam";
export type ProviderName = "bm25" | "content" | "events";
export type Stage = "smoke" | "qualification" | "full";
export interface Turn {
    identity: string;
    originalId: string;
    session: string;
    role: "user" | "assistant" | "system" | "tool";
    speaker: string;
    text: string;
    content: string;
    originalTime: string;
    timestamp: string;
    timeSource: "turn" | "session";
}
export interface Document {
    id: string;
    unit: string;
    content: string;
    timestamp: string;
    title: string;
    messages: Turn[];
    sourceIds: string[];
}
export interface Query {
    id: string;
    unit: string;
    query: string;
    category: string;
    goldIds: string[];
    goldAnswers: string[];
    rubric: string[];
    timestamp?: string;
}
export interface Evidence {
    id: string;
    content: string;
    sourceIds: string[];
}
export interface Prediction {
    queryId: string;
    query: string;
    category: string;
    answer: string;
    context: string;
    retrievedSourceIds: string[];
    retrieveTimeMs: number;
    nativeAnswer?: Record<string, unknown>;
}
export interface ScoredPrediction extends Prediction {
    correct: boolean;
    score: number;
    judgeReason: string;
    evidenceRecall: number | null;
    evidenceRecallGranularity: string;
    totalSeconds: number;
    eventOrdering?: { f1: number; tauNorm: number; finalScore: number };
}
export interface Host {
    execute(request: Record<string, unknown>): Promise<unknown>;
}
export interface Runtime {
    bridge: Host;
    close(): Promise<void>;
}
export type Generate = (
    prompt: string,
    properties: Record<string, unknown>,
) => Promise<Record<string, unknown>>;
