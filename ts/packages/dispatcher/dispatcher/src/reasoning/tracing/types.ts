// Copyright (c) Microsoft Corporation.
// Licensed under the MIT License.

/**
 * Type definitions for reasoning action execution tracing
 */

export interface ReasoningTrace {
    session: {
        sessionId: string;
        requestId: string;
        startTime: string;
        model: string;
        originalRequest: string;
        planReuseEnabled: boolean;
    };
    steps: ReasoningStep[];
    metrics: {
        totalSteps: number;
        totalToolCalls: number;
        duration: number;
        tokensUsed?: number;
    };
    result: {
        success: boolean;
        finalOutput?: any;
        error?: string;
    };
}

export interface ReasoningStep {
    stepNumber: number;
    timestamp: string;
    thinking?: {
        summary: string;
        fullThought: string;
    };
    action?: {
        tool: string; // "discover_actions" or "execute_action"
        schemaName?: string;
        actionName?: string;
        parameters: any;
    };
    result?: {
        success: boolean;
        data: any;
        error?: string;
        duration?: number;
    };
}

export interface TraceCollectorOptions {
    storage: any; // Storage interface from agent-sdk
    sessionId: string;
    originalRequest: string;
    requestId: string;
    model: string;
    planReuseEnabled: boolean;
}
