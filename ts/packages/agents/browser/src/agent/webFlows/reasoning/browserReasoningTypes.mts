// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

export interface BrowserReasoningConfig {
    goal: string;
    startUrl?: string;
    maxSteps: number;
    model: string;
    provider?: "copilot" | "claude";
    traceCapture: boolean;
    abortSignal?: AbortSignal;
}

export const DEFAULT_BROWSER_REASONING_CONFIG: Omit<
    BrowserReasoningConfig,
    "goal"
> = {
    maxSteps: 30,
    model: "gpt-5.6-sol",
    provider: "copilot",
    traceCapture: true,
};

export interface BrowserReasoningTrace {
    goal: string;
    startUrl: string;
    steps: BrowserTraceStep[];
    result: { success: boolean; summary: string };
    duration: number;
}

export interface BrowserTraceStep {
    stepNumber: number;
    thinking: string;
    action: {
        tool: string;
        args: Record<string, unknown>;
    };
    result: {
        success: boolean;
        data?: unknown;
        screenshot?: string;
        pageUrl?: string;
    };
    timestamp: number;
}
